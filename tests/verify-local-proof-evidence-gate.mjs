#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {
  LOCAL_PROOF_EVIDENCE_BLOCKED_STATUS,
  LOCAL_PROOF_EVIDENCE_REPAIR_ACTION,
  LOCAL_PROOF_EVIDENCE_REPAIR_HANDLER,
  compileLocalProofEvidenceGate,
  validateLocalProofEvidenceGate,
} from "../control/local-proof-evidence-gate.mjs";

const sha = (value) => canonicalDigest({value});
const authorityBinding = {
  authority_commit: "937399b99debb189b6e5f21fc4dc239bcde28e19",
  authority_tree: "c15c8201dc4d76b7952833b47a6f8b7f703c5892",
  authority_receipt_ref: "ref:state/controller-campaign/agentos-autonomous-dispatch-liveness-gate.authority-937399b.receipt.json",
  authority_receipt_sha256: "4ea69de05743642b5a4533d53f06cbf43d18dd82bf2d951dde6c98193c6d437d",
  source_mapping_sha256: "72da1380db142b59d32a5e097f43d33c1519a06f59775067d44d8c58e05ceb33",
};
const requiredSteps = [
  "PROVE_LOCAL_BUILD_AND_TEST",
  "PROVE_LOCAL_INSTALLATION",
  "REPLAY_DEPENDENCY_CLOSURE_OFFLINE",
  "ZERO_TRACE_ROLLBACK_AND_UNINSTALL_PROOF",
];
const proofResult = {
  result_ref: "ref:state/controller-campaign/controller-import.orchestrator.local-candidate-proof.result.937399b.v1.json",
  result_sha256: "4ec092d394e3c5a0abb6c92a80cfcb23a4afb058c2b4001d476c7783f8919d06",
  readback_ref: "ref:state/controller-campaign/controller-import.orchestrator.local-candidate-proof.readback.937399b.v1.json",
  readback_sha256: "8283faaeac521c1b963a939acb20d90e97bd0a9f30e23b6df616a5729b1d3545",
  successor_ref: "ref:state/controller-campaign/controller-import.orchestrator.local-candidate-proof.successor.937399b.v1.json",
  successor_sha256: "9bc87a3574fdfa819b8118fba55de23f79ae84bfd1cb31669669cc9220a6d780",
  observed_status: "LOCAL_PROOF_REQUIRED_EVIDENCE_BLOCKED",
  proof_claimed: false,
  all_mandatory_steps_satisfied: false,
  unresolved_required_steps: requiredSteps,
  evidence_ceiling: "No build/test, installation, offline dependency-closure, runtime/browser, or zero-trace proof is claimed; all four mandatory gates remain unresolved.",
  source_action: "RUN_LOCAL_CANDIDATE_PROOF",
  source_handler: "HANDLER.RUNTIME.RUN_LOCAL_CANDIDATE_PROOF",
  handler_invoked: true,
  direct_consumer: "INDEPENDENT_PLATFORM_REVIEW",
  controller_approval_required: false,
  protected_event_id: null,
};
const evidence = (id, value) => ({evidence_id: id, reference: `ref:state/controller-campaign/${id.toLowerCase()}.json`, sha256: sha(value)});
const evidenceRefs = [
  evidence("EVIDENCE.AGENTOS.AUTHORITY.937399B", "authority"),
  evidence("EVIDENCE.LOCAL.PROOF.READBACK", proofResult.readback_sha256),
  evidence("EVIDENCE.LOCAL.PROOF.RESULT", proofResult.result_sha256),
  evidence("EVIDENCE.LOCAL.PROOF.SOURCE.SUCCESSOR", proofResult.successor_sha256),
].sort((left, right) => left.evidence_id.localeCompare(right.evidence_id));
const hostileFixtureRefs = [
  "FIXTURE.LOCAL.PROOF.FALSE_PASS_CLAIM",
  "FIXTURE.LOCAL.PROOF.MISSING_EVIDENCE_PLACEHOLDER",
  "FIXTURE.LOCAL.PROOF.MISSING_REQUIRED_STEP",
  "FIXTURE.LOCAL.PROOF.NULL_DIGEST",
  "FIXTURE.LOCAL.PROOF.PROTECTED_BYPASS",
  "FIXTURE.LOCAL.PROOF.STALE_AUTHORITY",
  "FIXTURE.LOCAL.PROOF.TAMPERED_GATE_DIGEST",
].sort();
const persistence = {
  receipt_ref: "ref:state/controller-campaign/controller-import.orchestrator.local-candidate-proof.evidence-block.gate.937399b.v1.json",
  receipt_sha256: sha("local-proof-evidence-persistence"),
  atomic: true,
  same_turn: true,
  write_scope: "CONTROL_PLANE_ONLY",
};

const gate = compileLocalProofEvidenceGate({
  gateId: "GATE.WORKFLOW.LOCAL.PROOF.EVIDENCE.BLOCK.937399B",
  defectId: "DEFECT.WORKFLOW.LOCAL.PROOF.REQUIRED.EVIDENCE.BLOCKED.937399B",
  authorityBinding,
  proofResult,
  requiredSteps,
  evidenceRefs,
  hostileFixtureRefs,
  persistence,
});
validateLocalProofEvidenceGate(gate, {expectedAuthorityBinding: authorityBinding});
assert.equal(gate.status, LOCAL_PROOF_EVIDENCE_BLOCKED_STATUS);
assert.equal(gate.decision.next_action, LOCAL_PROOF_EVIDENCE_REPAIR_ACTION);
assert.equal(gate.decision.next_handler, LOCAL_PROOF_EVIDENCE_REPAIR_HANDLER);
assert.equal(gate.decision.proof_claimed, false);
assert.equal(gate.missing_evidence.length, 4);
assert(gate.missing_evidence.every((entry) => entry.status === "MISSING" && entry.evidence_ref === null && entry.evidence_sha256 === null));
assert.equal(gate.custody.consumer_product_mutated, false);
assert.equal(gate.custody.protected_event_id, null);

const rehash = (candidate) => {
  candidate.gate_sha256 = canonicalDigest({...candidate, gate_sha256: null});
  return candidate;
};
const rejects = (mutator, pattern) => {
  const candidate = structuredClone(gate);
  mutator(candidate);
  rehash(candidate);
  assert.throws(() => validateLocalProofEvidenceGate(candidate, {expectedAuthorityBinding: authorityBinding}), pattern);
};
rejects((candidate) => { candidate.proof_result.proof_claimed = true; }, /false PASS|claim proof/u);
rejects((candidate) => { candidate.proof_result.all_mandatory_steps_satisfied = true; }, /all mandatory|false PASS/u);
rejects((candidate) => { candidate.status = "PASS"; }, /cannot report PASS|status/u);
rejects((candidate) => { candidate.missing_evidence[0].evidence_sha256 = "0".repeat(64); }, /cannot carry false evidence|placeholder/u);
rejects((candidate) => { candidate.missing_evidence.pop(); }, /does not match|fields|missing evidence/u);
rejects((candidate) => { candidate.successor.next_handler = "HANDLER.PROTECTED_EVENT_WAIT"; }, /successor handler|block repair/u);
rejects((candidate) => { candidate.successor.protected_event_id = "PROTECTED.RUNTIME"; }, /boundary|protected/u);
rejects((candidate) => { candidate.proof_result.handler_invoked = false; }, /invocation/u);
rejects((candidate) => { candidate.authority_binding.authority_commit = "8".repeat(40); }, /stale/u);
const stale = structuredClone(gate);
stale.authority_binding.authority_commit = "8".repeat(40);
assert.throws(() => validateLocalProofEvidenceGate(stale, {expectedAuthorityBinding: authorityBinding}), /stale|digest/u);
const tampered = structuredClone(gate);
tampered.gate_sha256 = sha("tampered");
assert.throws(() => validateLocalProofEvidenceGate(tampered), /gate digest/u);

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../schemas/local-proof-evidence-gate.v1.json");
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
assert.deepEqual(schema.required, [
  "schema", "version", "gate_id", "defect_id", "authority_binding", "proof_result", "required_steps", "missing_evidence",
  "decision", "successor", "custody", "evidence_refs", "hostile_fixture_refs", "status", "gate_sha256",
]);
assert.equal(schema.properties.status.const, LOCAL_PROOF_EVIDENCE_BLOCKED_STATUS);
assert.equal(schema.properties.decision.properties.next_action.const, LOCAL_PROOF_EVIDENCE_REPAIR_ACTION);
assert.equal(schema.properties.decision.properties.next_handler.const, LOCAL_PROOF_EVIDENCE_REPAIR_HANDLER);
assert.equal(schema.properties.custody.properties.consumer_product_mutated.const, false);
assert.equal(schema.$defs.missingEvidence.properties.evidence_sha256.type, "null");

console.log("PASS local proof evidence gate: fail-closed missing inventory, false-PASS rejection, authority/digest binding, repair successor, custody boundary, and hostile coverage");
