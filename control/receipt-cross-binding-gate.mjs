#!/usr/bin/env node

/*
 * Project-agnostic gate for content-addressed control-plane chain identity.
 *
 * A parseable receipt is not current merely because each file has a valid
 * digest.  Every member of a source/dispatch/readback/lifecycle/handoff
 * chain must name the same authority and chain identity, and every nested
 * reference must point at the digest of the corresponding current member.
 * This gate is compiler-only and never dispatches work itself.
 */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const RECEIPT_CROSS_BINDING_GATE_SCHEMA = "agentos.receipt_cross_binding_gate.v1";
export const RECEIPT_CROSS_BINDING_GATE_VERSION = 1;
export const RECEIPT_CROSS_BINDING_REPAIR_ACTION = "REPAIR_BLOCKS";
export const RECEIPT_CROSS_BINDING_REPAIR_HANDLER = "HANDLER.ORCHESTRATOR_BLOCK_REPAIR";
export const RECEIPT_CROSS_BINDING_ARTIFACT_IDS = Object.freeze([
  "source_successor",
  "dispatch_receipt",
  "dispatch_readback",
  "next_lifecycle",
  "handoff",
]);
export const RECEIPT_CROSS_BINDING_HOSTILE_FIXTURE_REFS = Object.freeze([
  "FIXTURE.RECEIPT_CROSS_BINDING.AUTHORITY_DRIFT",
  "FIXTURE.RECEIPT_CROSS_BINDING.DISPATCH_READBACK_DRIFT",
  "FIXTURE.RECEIPT_CROSS_BINDING.HANDOFF_DRIFT",
  "FIXTURE.RECEIPT_CROSS_BINDING.LIFECYCLE_DRIFT",
  "FIXTURE.RECEIPT_CROSS_BINDING.NULL_DIGEST",
  "FIXTURE.RECEIPT_CROSS_BINDING.SOURCE_SUCCESSOR_DRIFT",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const REFERENCE = /^(?:opaque:|ref:)[^\s]+$/u;
const GATE_KEYS = Object.freeze([
  "schema", "version", "gate_id", "status", "defect_id", "authority_binding", "chain_identity",
  "artifacts", "nested_bindings", "cross_binding_rule", "custody", "evidence_refs",
  "hostile_fixture_refs", "source_action", "next_action", "next_handler", "dispatch_observed",
  "duplicate_dispatch", "same_turn_dispatch", "spawnable", "gate_sha256",
]);
const AUTHORITY_KEYS = Object.freeze(["commit", "tree", "receipt_ref", "receipt_sha256"]);
const IDENTITY_KEYS = Object.freeze(["chain_id", "authority_commit", "authority_tree"]);
const ARTIFACT_KEYS = Object.freeze(["reference", "sha256", "authority_commit", "authority_tree", "chain_id"]);
const NESTED_BINDING_KEYS = Object.freeze([
  "source_successor_authority_receipt_sha256",
  "dispatch_receipt_authority_receipt_sha256",
  "dispatch_readback_authority_receipt_sha256",
  "next_lifecycle_authority_receipt_sha256",
  "handoff_authority_receipt_sha256",
  "dispatch_receipt_source_successor_sha256",
  "dispatch_readback_source_successor_sha256",
  "dispatch_readback_dispatch_receipt_sha256",
  "dispatch_readback_next_lifecycle_sha256",
  "next_lifecycle_source_receipt_sha256",
  "next_lifecycle_handoff_sha256",
  "handoff_source_successor_sha256",
  "handoff_dispatch_readback_sha256",
  "handoff_next_lifecycle_sha256",
]);
const RULE_KEYS = Object.freeze([
  "all_artifacts_share_current_authority", "all_digests_non_null_and_canonical",
  "nested_refs_match_artifact_digests", "stale_or_mixed_authority_rejected",
  "source_successor_and_lifecycle_identity_match", "no_duplicate_dispatch",
]);
const CUSTODY_KEYS = Object.freeze([
  "compiler_only", "controller_approval_required", "execution_owner", "direct_consumer",
  "product_mutation", "provider_access", "credential_access", "spend", "destructive_work",
  "worker_activation", "wave_activation",
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, label) {
  assert(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const required = [...expected].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(required), `${label} fields mismatch`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
  assert(value !== "0".repeat(64) && value !== "f".repeat(64), `${label} may not be a placeholder digest`);
}

function requireCommit(value, label) {
  assert(typeof value === "string" && COMMIT.test(value), `${label} must be a 40-character lowercase commit`);
  assert(value !== "0".repeat(40) && value !== "f".repeat(40), `${label} may not be a placeholder commit`);
}

function requireIdentifier(value, label) {
  assert(typeof value === "string" && IDENTIFIER.test(value), `${label} must be a stable identifier`);
}

function requireReference(value, label) {
  assert(typeof value === "string" && REFERENCE.test(value), `${label} must be a control-plane reference`);
}

function validateAuthorityBinding(authority) {
  exactKeys(authority, AUTHORITY_KEYS, "Receipt cross-binding authority");
  requireCommit(authority.commit, "Receipt cross-binding authority commit");
  requireCommit(authority.tree, "Receipt cross-binding authority tree");
  requireReference(authority.receipt_ref, "Receipt cross-binding authority reference");
  requireSha(authority.receipt_sha256, "Receipt cross-binding authority digest");
  return authority;
}

function validateIdentity(identity, authority) {
  exactKeys(identity, IDENTITY_KEYS, "Receipt cross-binding chain identity");
  requireIdentifier(identity.chain_id, "Receipt cross-binding chain id");
  requireCommit(identity.authority_commit, "Receipt cross-binding identity commit");
  requireCommit(identity.authority_tree, "Receipt cross-binding identity tree");
  assert(identity.authority_commit === authority.commit, "Receipt cross-binding identity authority commit drift");
  assert(identity.authority_tree === authority.tree, "Receipt cross-binding identity authority tree drift");
  return identity;
}

function validateArtifacts(artifacts, authority, identity) {
  exactKeys(artifacts, RECEIPT_CROSS_BINDING_ARTIFACT_IDS, "Receipt cross-binding artifacts");
  const artifactDigests = [];
  const artifactReferences = [];
  for (const artifactId of RECEIPT_CROSS_BINDING_ARTIFACT_IDS) {
    const artifact = artifacts[artifactId];
    exactKeys(artifact, ARTIFACT_KEYS, `Receipt cross-binding ${artifactId}`);
    requireReference(artifact.reference, `Receipt cross-binding ${artifactId} reference`);
    requireSha(artifact.sha256, `Receipt cross-binding ${artifactId} digest`);
    requireCommit(artifact.authority_commit, `Receipt cross-binding ${artifactId} authority commit`);
    requireCommit(artifact.authority_tree, `Receipt cross-binding ${artifactId} authority tree`);
    requireIdentifier(artifact.chain_id, `Receipt cross-binding ${artifactId} chain id`);
    assert(artifact.authority_commit === authority.commit, `Receipt cross-binding ${artifactId} authority commit is stale`);
    assert(artifact.authority_tree === authority.tree, `Receipt cross-binding ${artifactId} authority tree is stale`);
    assert(artifact.chain_id === identity.chain_id, `Receipt cross-binding ${artifactId} chain identity is stale`);
    artifactDigests.push(artifact.sha256);
    artifactReferences.push(artifact.reference);
  }
  assert(new Set(artifactDigests).size === artifactDigests.length, "Receipt cross-binding artifacts must have distinct digests");
  assert(new Set(artifactReferences).size === artifactReferences.length, "Receipt cross-binding artifacts must have distinct references");
  return artifacts;
}

function validateNestedBindings(nested, artifacts, authority) {
  exactKeys(nested, NESTED_BINDING_KEYS, "Receipt cross-binding nested references");
  const authoritySha = authority.receipt_sha256;
  for (const key of NESTED_BINDING_KEYS) requireSha(nested[key], `Receipt cross-binding ${key}`);
  for (const key of [
    "source_successor_authority_receipt_sha256",
    "dispatch_receipt_authority_receipt_sha256",
    "dispatch_readback_authority_receipt_sha256",
    "next_lifecycle_authority_receipt_sha256",
    "handoff_authority_receipt_sha256",
  ]) assert(nested[key] === authoritySha, `Receipt cross-binding ${key} is stale`);
  assert(nested.dispatch_receipt_source_successor_sha256 === artifacts.source_successor.sha256, "Receipt cross-binding dispatch receipt source successor is stale");
  assert(nested.dispatch_readback_source_successor_sha256 === artifacts.source_successor.sha256, "Receipt cross-binding dispatch readback source successor is stale");
  assert(nested.dispatch_readback_dispatch_receipt_sha256 === artifacts.dispatch_receipt.sha256, "Receipt cross-binding dispatch readback receipt is stale");
  assert(nested.dispatch_readback_next_lifecycle_sha256 === artifacts.next_lifecycle.sha256, "Receipt cross-binding dispatch readback lifecycle is stale");
  assert(nested.next_lifecycle_source_receipt_sha256 === artifacts.dispatch_receipt.sha256, "Receipt cross-binding lifecycle source receipt is stale");
  assert(nested.next_lifecycle_handoff_sha256 === artifacts.handoff.sha256, "Receipt cross-binding lifecycle handoff is stale");
  assert(nested.handoff_source_successor_sha256 === artifacts.source_successor.sha256, "Receipt cross-binding handoff source successor is stale");
  assert(nested.handoff_dispatch_readback_sha256 === artifacts.dispatch_readback.sha256, "Receipt cross-binding handoff dispatch readback is stale");
  assert(nested.handoff_next_lifecycle_sha256 === artifacts.next_lifecycle.sha256, "Receipt cross-binding handoff lifecycle is stale");
  return nested;
}

function validateRule(rule) {
  exactKeys(rule, RULE_KEYS, "Receipt cross-binding rule");
  for (const key of RULE_KEYS) assert(rule[key] === true, `Receipt cross-binding rule ${key} must be enforced`);
  return rule;
}

function validateCustody(custody) {
  exactKeys(custody, CUSTODY_KEYS, "Receipt cross-binding custody");
  assert(custody.compiler_only === true, "Receipt cross-binding custody must remain compiler-only");
  assert(custody.controller_approval_required === false, "Receipt cross-binding custody cannot require Controller approval");
  assert(custody.execution_owner === "LANE_AGENT", "Receipt cross-binding execution owner is invalid");
  assert(custody.direct_consumer === "INDEPENDENT_PLATFORM_REVIEW", "Receipt cross-binding direct consumer is invalid");
  for (const key of ["product_mutation", "provider_access", "credential_access", "spend", "destructive_work", "worker_activation", "wave_activation"]) {
    assert(custody[key] === false, `Receipt cross-binding custody ${key} must remain closed`);
  }
  return custody;
}

function validateEvidenceRefs(refs) {
  assert(Array.isArray(refs) && refs.length > 0, "Receipt cross-binding evidence refs are required");
  const ids = refs.map((ref, index) => {
    exactKeys(ref, ["evidence_id", "reference", "sha256"], `Receipt cross-binding evidence ${index}`);
    requireIdentifier(ref.evidence_id, `Receipt cross-binding evidence ${index} id`);
    requireReference(ref.reference, `Receipt cross-binding evidence ${index} reference`);
    requireSha(ref.sha256, `Receipt cross-binding evidence ${index} digest`);
    return ref.evidence_id;
  });
  const ordered = [...ids].sort(compareUtf8);
  assert(new Set(ids).size === ids.length && JSON.stringify(ids) === JSON.stringify(ordered), "Receipt cross-binding evidence refs must be sorted and unique");
  return refs;
}

function validateHostileFixtureRefs(refs) {
  assert(Array.isArray(refs), "Receipt cross-binding hostile fixture refs are required");
  const ordered = [...refs].sort(compareUtf8);
  assert(JSON.stringify(refs) === JSON.stringify(ordered), "Receipt cross-binding hostile fixture refs must be sorted");
  assert(new Set(refs).size === refs.length, "Receipt cross-binding hostile fixture refs must be unique");
  assert(JSON.stringify(refs) === JSON.stringify(RECEIPT_CROSS_BINDING_HOSTILE_FIXTURE_REFS), "Receipt cross-binding hostile fixture coverage is incomplete");
  return refs;
}

export function validateReceiptCrossBindingGate(gate, {expectedAuthorityBinding = null} = {}) {
  exactKeys(gate, GATE_KEYS, "Receipt cross-binding gate");
  assert(gate.schema === RECEIPT_CROSS_BINDING_GATE_SCHEMA && gate.version === RECEIPT_CROSS_BINDING_GATE_VERSION, "Receipt cross-binding gate identity is invalid");
  requireIdentifier(gate.gate_id, "Receipt cross-binding gate id");
  assert(gate.status === "REPAIR_REQUIRED", "Receipt cross-binding gate must remain a repair requirement");
  requireIdentifier(gate.defect_id, "Receipt cross-binding defect id");
  validateAuthorityBinding(gate.authority_binding);
  if (expectedAuthorityBinding !== null) {
    assert(canonicalDigest(gate.authority_binding) === canonicalDigest(expectedAuthorityBinding), "Receipt cross-binding authority is stale");
  }
  validateIdentity(gate.chain_identity, gate.authority_binding);
  validateArtifacts(gate.artifacts, gate.authority_binding, gate.chain_identity);
  validateNestedBindings(gate.nested_bindings, gate.artifacts, gate.authority_binding);
  validateRule(gate.cross_binding_rule);
  validateCustody(gate.custody);
  validateEvidenceRefs(gate.evidence_refs);
  validateHostileFixtureRefs(gate.hostile_fixture_refs);
  assert(gate.source_action === "COMPILE_BLOCK_PATCH", "Receipt cross-binding source action is invalid");
  assert(gate.next_action === RECEIPT_CROSS_BINDING_REPAIR_ACTION, "Receipt cross-binding next action is invalid");
  assert(gate.next_handler === RECEIPT_CROSS_BINDING_REPAIR_HANDLER, "Receipt cross-binding next handler is invalid");
  assert(gate.dispatch_observed === true, "Receipt cross-binding requires the existing dispatch observation");
  assert(gate.duplicate_dispatch === false, "Receipt cross-binding cannot duplicate dispatch");
  assert(gate.same_turn_dispatch === true, "Receipt cross-binding requires same-turn evidence");
  assert(gate.spawnable === false, "Receipt cross-binding gate must remain non-spawnable");
  requireSha(gate.gate_sha256, "Receipt cross-binding gate digest");
  assert(gate.gate_sha256 === canonicalDigest({...gate, gate_sha256: null}), "Receipt cross-binding gate digest mismatch");
  return gate;
}

export function compileReceiptCrossBindingGate({
  gateId,
  defectId,
  authorityBinding,
  chainIdentity,
  artifacts,
  nestedBindings,
  custody,
  evidenceRefs,
  dispatchObserved = true,
  duplicateDispatch = false,
  sameTurnDispatch = true,
} = {}) {
  requireIdentifier(gateId, "Receipt cross-binding gate id");
  requireIdentifier(defectId, "Receipt cross-binding defect id");
  const gate = {
    schema: RECEIPT_CROSS_BINDING_GATE_SCHEMA,
    version: RECEIPT_CROSS_BINDING_GATE_VERSION,
    gate_id: gateId,
    status: "REPAIR_REQUIRED",
    defect_id: defectId,
    authority_binding: structuredClone(authorityBinding),
    chain_identity: structuredClone(chainIdentity),
    artifacts: structuredClone(artifacts),
    nested_bindings: structuredClone(nestedBindings),
    cross_binding_rule: {
      all_artifacts_share_current_authority: true,
      all_digests_non_null_and_canonical: true,
      nested_refs_match_artifact_digests: true,
      stale_or_mixed_authority_rejected: true,
      source_successor_and_lifecycle_identity_match: true,
      no_duplicate_dispatch: true,
    },
    custody: structuredClone(custody),
    evidence_refs: structuredClone(evidenceRefs),
    hostile_fixture_refs: [...RECEIPT_CROSS_BINDING_HOSTILE_FIXTURE_REFS],
    source_action: "COMPILE_BLOCK_PATCH",
    next_action: RECEIPT_CROSS_BINDING_REPAIR_ACTION,
    next_handler: RECEIPT_CROSS_BINDING_REPAIR_HANDLER,
    dispatch_observed: dispatchObserved,
    duplicate_dispatch: duplicateDispatch,
    same_turn_dispatch: sameTurnDispatch,
    spawnable: false,
    gate_sha256: null,
  };
  gate.gate_sha256 = canonicalDigest({...gate, gate_sha256: null});
  return validateReceiptCrossBindingGate(gate);
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Receipt cross-binding gate loaded\n");
