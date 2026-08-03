#!/usr/bin/env node

import {
  compileAcceptance,
  sha256,
} from "./question-tree.mjs";

const HEX64 = /^[0-9a-f]{64}$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function exactKeys(value, keys, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(actual.length === expected.length
    && actual.every((key, index) => key === expected[index]), `${label} fields mismatch`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && HEX64.test(value), `${label} must be a lowercase SHA-256`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.length > 0, `${label} must be a nonempty string`);
}

function same(left, right) {
  return sha256(left) === sha256(right);
}

function validateUtc(value, label) {
  requireString(value, label);
  assert(UTC.test(value) && !Number.isNaN(Date.parse(value)), `${label} must be UTC`);
}

function compiledResultDigest(result) {
  return sha256(result);
}

function buildAuditorAttestation({
  campaignId,
  auditorSessionId,
  compiledResult,
  changeManifestSha256,
  evidenceCacheSha256,
  evaluatedAtUtc,
  criticalFreezes,
}) {
  const attestation = {
    schema: "governance.product_acceptance_auditor_attestation.v1",
    campaign_id: campaignId,
    auditor_session_id: auditorSessionId,
    question_tree_sha256: compiledResult.question_tree_sha256,
    change_manifest_sha256: changeManifestSha256,
    observations_sha256: compiledResult.observations_sha256,
    evidence_cache_sha256: evidenceCacheSha256,
    compiled_result_sha256: compiledResultDigest(compiledResult),
    critical_freezes_sha256: sha256(criticalFreezes),
    evaluated_at_utc: evaluatedAtUtc,
  };
  exactKeys(attestation, [
    "schema", "campaign_id", "auditor_session_id", "question_tree_sha256",
    "change_manifest_sha256", "observations_sha256", "evidence_cache_sha256",
    "compiled_result_sha256", "critical_freezes_sha256", "evaluated_at_utc",
  ], "Auditor acceptance attestation");
  return attestation;
}

export function compileProductAcceptanceProof({
  tree,
  observations,
  evidence_cache: evidenceCache,
  auditor_session_id: auditorSessionId,
  evaluated_at_utc: evaluatedAtUtc,
  critical_freezes: criticalFreezes,
}) {
  requireString(auditorSessionId, "Auditor session");
  validateUtc(evaluatedAtUtc, "evaluation time");
  assert(Array.isArray(criticalFreezes), "critical freezes must be an array");
  const compiledResult = compileAcceptance(tree, observations);
  const evidenceCacheSha256 = sha256(evidenceCache);
  const attestation = buildAuditorAttestation({
    campaignId: compiledResult.campaign_id,
    auditorSessionId,
    compiledResult,
    changeManifestSha256: tree.selection.change_manifest_sha256,
    evidenceCacheSha256,
    evaluatedAtUtc,
    criticalFreezes,
  });
  const productAcceptance = {
    question_tree_sha256: compiledResult.question_tree_sha256,
    change_manifest_sha256: tree.selection.change_manifest_sha256,
    observations_sha256: compiledResult.observations_sha256,
    evidence_cache_sha256: evidenceCacheSha256,
    acceptance_compiler_result_sha256: compiledResultDigest(compiledResult),
    auditor_attestation_sha256: sha256(attestation),
    open_question_ids: compiledResult.OPEN_QUESTION_IDS,
    authorized_exception_ids: compiledResult.AUTHORIZED_EXCEPTION_IDS,
    roots: compiledResult.roots,
    rc_ready: compiledResult.RC_READY,
    auditor_session_id: auditorSessionId,
    evaluated_at_utc: evaluatedAtUtc,
    critical_freezes: criticalFreezes,
  };
  return {
    proof: {
      schema: "governance.product_acceptance_proof.v1",
      tree,
      observations,
      evidence_cache: evidenceCache,
      auditor_attestation: attestation,
      evaluated_at_utc: evaluatedAtUtc,
      critical_freezes: criticalFreezes,
    },
    product_acceptance: productAcceptance,
  };
}

export function verifyProductAcceptanceProof(acceptance, proof, expectedCampaignId) {
  exactKeys(proof, [
    "schema", "tree", "observations", "evidence_cache", "auditor_attestation",
    "evaluated_at_utc", "critical_freezes",
  ], "Product-acceptance proof");
  assert(proof.schema === "governance.product_acceptance_proof.v1", "Product-acceptance proof schema mismatch");
  assert(proof.tree?.campaign_id === expectedCampaignId, "Product-acceptance proof campaign mismatch");
  const rebuilt = compileProductAcceptanceProof({
    tree: proof.tree,
    observations: proof.observations,
    evidence_cache: proof.evidence_cache,
    auditor_session_id: proof.auditor_attestation?.auditor_session_id,
    evaluated_at_utc: proof.evaluated_at_utc,
    critical_freezes: proof.critical_freezes,
  });
  assert(same(proof.auditor_attestation, rebuilt.proof.auditor_attestation),
    "Auditor attestation is not derived from the exact compiler inputs");
  const expected = rebuilt.product_acceptance;
  for (const field of Object.keys(expected)) {
    assert(same(acceptance[field], expected[field]),
      `Product acceptance field is not bound to the compiler result: ${field}`);
  }
  requireSha(acceptance.acceptance_receipt_sha256, "acceptance receipt");
  return rebuilt;
}
