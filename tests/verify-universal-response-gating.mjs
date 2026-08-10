#!/usr/bin/env node

import assert from "node:assert/strict";
import {loadGateCatalog, compileGateCatalog, canonicalDigest} from "../control/gate-catalog-compiler.mjs";
import {
  compileUniversalResponseEnvelope,
  validateUniversalResponseEnvelope,
} from "../control/universal-response-gating.mjs";

const catalog = await loadGateCatalog(new URL("../governance/gate-catalog.v1.json", import.meta.url));
const tree = compileGateCatalog(catalog);
const graph = tree.graphs.find((candidate) => candidate.graph_id === "GENERAL_RESPONSE");
assert(graph);
const identity = {
  source_ref: "REF_SOURCE_001",
  worktree_ref: "REF_WORKTREE_001",
  session_ref: "REF_WORKER_001",
  goal_ref: "REF_GOAL_001",
  environment_ref: "REF_ENVIRONMENT_001",
};

function evidenceRecord(gate, slot, issuerKind, issuerRef) {
  const record = {
    evidence_id: `EVIDENCE_${gate.gate_id}_${slot.toUpperCase()}`,
    evidence_digest: null,
    issuer_kind: issuerKind,
    issuer_ref: issuerRef,
    source_kind: issuerKind,
    observed_identity: structuredClone(identity),
    supports_answer: true,
  };
  record.evidence_digest = canonicalDigest(record);
  return record;
}

let firstEvidenceDigest = null;
const answers = Object.fromEntries(graph.gate_ids.map((gateId, gateIndex) => {
  const gate = tree.gates.find((candidate) => candidate.gate_id === gateId);
  const evidence = Object.fromEntries(gate.evidence.map((slot, slotIndex) => {
    const independent = gateIndex === 0 && slotIndex === 0;
    const record = evidenceRecord(gate, slot, independent ? "INDEPENDENT_AUDITOR" : "HOST_READBACK", independent ? "REF_AUDITOR_001" : "REF_HOST_001");
    if (independent) firstEvidenceDigest = record.evidence_digest;
    return [slot, record];
  }));
  return [gateId, {answer: "YES", evidence}];
}));

const handoff = {
  status: "PRESERVED",
  handoff_sha256: null,
  next_action: "Continue only from this preserved response handoff.",
  limitation: "No unresolved gate limitation was observed in this prepared fixture.",
  failure_classification: null,
  repair_route: null,
};
handoff.handoff_sha256 = canonicalDigest(handoff);

const envelope = compileUniversalResponseEnvelope({
  tree,
  graphId: graph.graph_id,
  context: "RESPONSE",
  answers,
  expectedIdentity: identity,
  claims: [{
    claim_id: "CLAIM_RESPONSE_COMPLETE",
    gate_id: graph.entry_gate_id,
    text: "The response follows the named response gates.",
    evidence_digests: [firstEvidenceDigest],
  }],
  publicText: "The response follows the named response gates.",
  limitation: "No unresolved gate limitation was observed in this prepared fixture.",
  nextAction: "Continue only from this preserved response handoff.",
  independentCheck: {status: "PASS", reviewer_ref: "REF_AUDITOR_001", evidence_digest: firstEvidenceDigest},
  handoff,
  closeReadiness: {status: "NOT_READY", temporary_work_closed: false, active_temporary_count: 0, roster_readback_sha256: null},
});
assert.equal(envelope.status, "COMPLETE");
assert.equal(validateUniversalResponseEnvelope(envelope, {tree, answers, expectedIdentity}).envelope_sha256, envelope.envelope_sha256);

const pendingIndependent = {...envelope, independent_check: {status: "PENDING", reviewer_ref: null, evidence_digest: null}, envelope_sha256: null};
pendingIndependent.envelope_sha256 = canonicalDigest(pendingIndependent);
assert.throws(() => validateUniversalResponseEnvelope(pendingIndependent, {tree, answers, expectedIdentity}), /COMPLETE requires independent PASS/u);

const unknown = structuredClone(answers);
unknown[graph.entry_gate_id].answer = "UNKNOWN";
assert.throws(() => compileUniversalResponseEnvelope({
  tree,
  graphId: graph.graph_id,
  context: "RESPONSE",
  answers: unknown,
  expectedIdentity: identity,
  claims: envelope.claims,
  publicText: envelope.public_text,
  limitation: envelope.limitation,
  nextAction: envelope.next_action,
  independentCheck: envelope.independent_check,
  handoff,
  closeReadiness: envelope.close_readiness,
}), /COMPLETE|unproven|failure/u);

console.log("universal response and handoff gating contract: PASS");
