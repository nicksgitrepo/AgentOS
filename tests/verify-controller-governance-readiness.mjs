#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  CONTROLLER_FORBIDDEN_CAPABILITIES,
  CONTROLLER_GOVERNANCE_GATE_IDS,
  compileControllerGovernance,
  compileControllerGovernanceReadiness,
  compileControllerWorkAcceptance,
  validateControllerGovernance,
  validateControllerGovernanceReadiness,
} from "../control/controller-governance-readiness.mjs";

const HASH = (label) => `${label}${"0".repeat(64 - label.length)}`;
const NOW = "2026-08-16T00:00:00.000Z";
const gateFor = (gateId) => ({
  gate_id: gateId,
  status: "PASS",
  rule: `The ${gateId} gate has a deterministic project-agnostic rule and exact stop behavior.`,
  evidence_sha256: HASH("a"),
  hostile_fixture_ids: [
    `FIXTURE.CONTROLLER.GOVERNANCE.${gateId.split(".").at(-1)}.MISSING`,
    `FIXTURE.CONTROLLER.GOVERNANCE.${gateId.split(".").at(-1)}.PLACEHOLDER`,
  ].sort(),
  authority: "PROJECT_AGNOSTIC_CONTROLLER",
  stop_condition: "Reject work acceptance and preserve the typed blocked readiness receipt until this gate passes.",
});

const governance = compileControllerGovernance({
  sourceCommit: "AGENTOS-COMMIT-1",
  sourceTree: "AGENTOS-TREE-1",
  gates: CONTROLLER_GOVERNANCE_GATE_IDS.map(gateFor),
});
validateControllerGovernance(governance);
assert.deepEqual(governance.required_gate_ids, CONTROLLER_GOVERNANCE_GATE_IDS);
assert.deepEqual(governance.forbidden_capabilities, CONTROLLER_FORBIDDEN_CAPABILITIES);

const readiness = compileControllerGovernanceReadiness({
  controllerId: "AGENTOS-CONTROLLER-1",
  governance,
  observedAtUtc: NOW,
});
validateControllerGovernanceReadiness(readiness);
assert.equal(readiness.injection_order, 1);
assert.equal(readiness.status, "READY_TO_ACCEPT_WORK");
assert.equal(readiness.acceptance_state, "WORK_ACCEPTANCE_ALLOWED");
assert.deepEqual(readiness.verified_gate_ids, CONTROLLER_GOVERNANCE_GATE_IDS);

const accepted = compileControllerWorkAcceptance({
  readiness,
  workRequestSha256: HASH("b"),
  acceptedAtUtc: NOW,
});
assert.equal(accepted.status, "ACCEPTED_AFTER_GOVERNANCE_READY");
assert.equal(accepted.readiness_sha256, readiness.readiness_sha256);

const missing = compileControllerGovernanceReadiness({
  controllerId: "AGENTOS-CONTROLLER-1",
  governance: null,
  observedAtUtc: NOW,
});
assert.equal(missing.status, "BLOCKED");
assert.equal(missing.failure_code, "GOVERNANCE_MISSING");
assert.throws(() => compileControllerWorkAcceptance({readiness: missing, workRequestSha256: HASH("b"), acceptedAtUtc: NOW}), /rejected until governance readiness passes/u);

const incomplete = structuredClone(governance);
incomplete.gates = incomplete.gates.slice(0, -1);
const incompleteReadiness = compileControllerGovernanceReadiness({controllerId: "AGENTOS-CONTROLLER-1", governance: incomplete, observedAtUtc: NOW});
assert.equal(incompleteReadiness.status, "BLOCKED");
assert.equal(incompleteReadiness.failure_code, "GOVERNANCE_INVALID");

const placeholder = structuredClone(governance);
placeholder.gates[0].rule = "TODO";
const placeholderReadiness = compileControllerGovernanceReadiness({controllerId: "AGENTOS-CONTROLLER-1", governance: placeholder, observedAtUtc: NOW});
assert.equal(placeholderReadiness.status, "BLOCKED");
assert.equal(placeholderReadiness.failure_code, "GOVERNANCE_INVALID");

const reordered = structuredClone(governance);
reordered.gates.reverse();
const reorderedReadiness = compileControllerGovernanceReadiness({controllerId: "AGENTOS-CONTROLLER-1", governance: reordered, observedAtUtc: NOW});
assert.equal(reorderedReadiness.status, "BLOCKED");
assert.equal(reorderedReadiness.failure_code, "GOVERNANCE_INVALID");

const tamperedReadiness = {...readiness, governance_sha256: HASH("c")};
assert.throws(() => validateControllerGovernanceReadiness(tamperedReadiness), /readiness digest mismatch/u);
const tamperedGovernance = {...governance, forbidden_capabilities: governance.forbidden_capabilities.slice(1)};
assert.throws(() => validateControllerGovernance(tamperedGovernance), /forbidden capabilities are incomplete/u);

console.log("PASS Controller governance injection/readiness: complete gate coverage, fail-closed work acceptance, typed blocked receipts, ordering, placeholder, and digest hostile checks");
