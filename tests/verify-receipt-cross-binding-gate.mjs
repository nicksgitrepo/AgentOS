#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import {canonicalDigest, compareUtf8} from "../control/content-addressing.mjs";
import {
  RECEIPT_CROSS_BINDING_GATE_SCHEMA,
  RECEIPT_CROSS_BINDING_HOSTILE_FIXTURE_REFS,
  compileReceiptCrossBindingGate,
  validateReceiptCrossBindingGate,
} from "../control/receipt-cross-binding-gate.mjs";

const digest = (value) => canonicalDigest({value});
const authority = {
  commit: "a".repeat(40),
  tree: "b".repeat(40),
  receipt_ref: "ref:control-plane/authority/current",
  receipt_sha256: digest("authority"),
};
const chainIdentity = {chain_id: "CHAIN.RECEIPT.CROSS.BINDING.001", authority_commit: authority.commit, authority_tree: authority.tree};
const artifact = (label, index) => ({
  reference: `ref:control-plane/${label}`,
  sha256: digest(`${label}-${index}`),
  authority_commit: authority.commit,
  authority_tree: authority.tree,
  chain_id: chainIdentity.chain_id,
});
const artifacts = {
  source_successor: artifact("source-successor", 1),
  dispatch_receipt: artifact("dispatch-receipt", 2),
  dispatch_readback: artifact("dispatch-readback", 3),
  next_lifecycle: artifact("next-lifecycle", 4),
  handoff: artifact("handoff", 5),
};
const nestedBindings = {
  source_successor_authority_receipt_sha256: authority.receipt_sha256,
  dispatch_receipt_authority_receipt_sha256: authority.receipt_sha256,
  dispatch_readback_authority_receipt_sha256: authority.receipt_sha256,
  next_lifecycle_authority_receipt_sha256: authority.receipt_sha256,
  handoff_authority_receipt_sha256: authority.receipt_sha256,
  dispatch_receipt_source_successor_sha256: artifacts.source_successor.sha256,
  dispatch_readback_source_successor_sha256: artifacts.source_successor.sha256,
  dispatch_readback_dispatch_receipt_sha256: artifacts.dispatch_receipt.sha256,
  dispatch_readback_next_lifecycle_sha256: artifacts.next_lifecycle.sha256,
  next_lifecycle_source_receipt_sha256: artifacts.dispatch_receipt.sha256,
  next_lifecycle_handoff_sha256: artifacts.handoff.sha256,
  handoff_source_successor_sha256: artifacts.source_successor.sha256,
  handoff_dispatch_readback_sha256: artifacts.dispatch_readback.sha256,
  handoff_next_lifecycle_sha256: artifacts.next_lifecycle.sha256,
};
const custody = {
  compiler_only: true,
  controller_approval_required: false,
  execution_owner: "LANE_AGENT",
  direct_consumer: "INDEPENDENT_PLATFORM_REVIEW",
  product_mutation: false,
  provider_access: false,
  credential_access: false,
  spend: false,
  destructive_work: false,
  worker_activation: false,
  wave_activation: false,
};
const evidenceRefs = [
  {evidence_id: "EVIDENCE.RECEIPT.CROSS_BINDING.AUTHORITY", reference: "ref:evidence/authority", sha256: digest("evidence-authority")},
  {evidence_id: "EVIDENCE.RECEIPT.CROSS_BINDING.STALE_CHAIN", reference: "ref:evidence/stale-chain", sha256: digest("evidence-stale-chain")},
].sort((left, right) => compareUtf8(left.evidence_id, right.evidence_id));

const gate = compileReceiptCrossBindingGate({
  gateId: "GATE.RECEIPT.CROSS_BINDING.001",
  defectId: "DEFECT.WORKFLOW.RECEIPT.CROSS_BINDING.MIXED_AUTHORITY.001",
  authorityBinding: authority,
  chainIdentity,
  artifacts,
  nestedBindings,
  custody,
  evidenceRefs,
});
validateReceiptCrossBindingGate(gate, {expectedAuthorityBinding: authority});
assert.equal(gate.schema, RECEIPT_CROSS_BINDING_GATE_SCHEMA);
assert.deepEqual(gate.hostile_fixture_refs, RECEIPT_CROSS_BINDING_HOSTILE_FIXTURE_REFS);

const rejects = (candidate, pattern) => {
  candidate.gate_sha256 = canonicalDigest({...candidate, gate_sha256: null});
  assert.throws(() => validateReceiptCrossBindingGate(candidate), pattern);
};

const authorityDrift = structuredClone(gate);
authorityDrift.artifacts.dispatch_readback.authority_commit = "c".repeat(40);
rejects(authorityDrift, /authority commit is stale/u);

const sourceDrift = structuredClone(gate);
sourceDrift.nested_bindings.dispatch_readback_source_successor_sha256 = digest("stale-source");
rejects(sourceDrift, /dispatch readback source successor is stale/u);

const lifecycleDrift = structuredClone(gate);
lifecycleDrift.nested_bindings.next_lifecycle_source_receipt_sha256 = digest("stale-receipt");
rejects(lifecycleDrift, /lifecycle source receipt is stale/u);

const handoffDrift = structuredClone(gate);
handoffDrift.nested_bindings.handoff_dispatch_readback_sha256 = digest("stale-readback");
rejects(handoffDrift, /handoff dispatch readback is stale/u);

const nullDigest = structuredClone(gate);
nullDigest.artifacts.source_successor.sha256 = null;
rejects(nullDigest, /must be a lowercase SHA-256/u);

const mixedChain = structuredClone(gate);
mixedChain.artifacts.handoff.chain_id = "CHAIN.STALE";
rejects(mixedChain, /chain identity is stale/u);

const duplicateArtifact = structuredClone(gate);
duplicateArtifact.artifacts.handoff.sha256 = duplicateArtifact.artifacts.source_successor.sha256;
duplicateArtifact.nested_bindings.next_lifecycle_handoff_sha256 = duplicateArtifact.artifacts.handoff.sha256;
rejects(duplicateArtifact, /artifacts must have distinct digests/u);

const fixtureCoverage = structuredClone(gate);
fixtureCoverage.hostile_fixture_refs = fixtureCoverage.hostile_fixture_refs.slice(1);
rejects(fixtureCoverage, /coverage is incomplete/u);

const schema = JSON.parse(fs.readFileSync(new URL("../schemas/receipt-cross-binding-gate.v1.json", import.meta.url), "utf8"));
assert.equal(schema.$id, RECEIPT_CROSS_BINDING_GATE_SCHEMA);
assert.equal(schema.additionalProperties, false);
assert.equal(schema.properties.dispatch_observed.const, true);
assert.equal(schema.properties.duplicate_dispatch.const, false);

console.log("PASS receipt cross-binding gate: current authority/chain identity, source/readback/receipt/lifecycle/handoff cross-bindings, stale/mixed/null rejection, no duplicate dispatch, and hostile coverage");
