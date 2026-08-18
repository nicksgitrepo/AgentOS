#!/usr/bin/env node

/* Typed ownership-first defect, repair, invalidation, re-QA, and retry loop. */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {
  OWNERSHIP_CLASSIFICATION_SCHEMA,
  SPAWNER_BLOCK_LAYERS,
  SPAWNER_DEFECT_KINDS,
  compileOwnershipClassification,
  computeInvalidationClosure,
} from "./spawner-bootstrap-governance.mjs";

export const SPAWNER_DEFECT_ENVELOPE_SCHEMA = "agentos.spawner_defect_envelope.v2";
export const SPAWNER_REPAIR_RECEIPT_SCHEMA = "agentos.spawner_repair_receipt.v1";

const SHA256 = /^[0-9a-f]{64}$/u;
function assert(condition, message, code = "SPAWNER_DEFECT_LOOP_INVALID") { if (!condition) { const error = new Error(message); error.code = code; throw error; } }
function requireSha(value, label) { assert(typeof value === "string" && SHA256.test(value), `${label} must be a SHA-256`); }
function requireText(value, label) { assert(typeof value === "string" && value.trim().length > 0, `${label} must be nonempty`); }
function digestBody(value, field) { return {...structuredClone(value), [field]: null}; }
function sorted(values) { return [...new Set(values)].sort(compareUtf8); }

export function compileSpawnerDefectEnvelope({defectId, defectKind, owningLayer, withinSpawnerAuthority, protectedBoundary = null, evidenceSha256, affectedDigests, requiredRepair, observedAtUtc}) {
  assert(SPAWNER_DEFECT_KINDS.includes(defectKind), "Spawner defect kind is invalid");
  assert(SPAWNER_BLOCK_LAYERS.includes(owningLayer), "Spawner defect owning layer is invalid");
  requireSha(evidenceSha256, "Spawner defect evidence");
  requireText(requiredRepair, "Spawner defect repair");
  const classification = compileOwnershipClassification({defectId, defectKind, affectedLayer: owningLayer, withinSpawnerAuthority, protectedBoundary, evidenceSha256, observedAtUtc});
  const envelope = {
    schema: SPAWNER_DEFECT_ENVELOPE_SCHEMA, version: 2, status: classification.ownership === "SPAWNER_LANE" ? "AUTONOMOUS_REPAIR_STARTED" : "REDISTRIBUTION_REQUIRED",
    defect_id: defectId, defect_kind: defectKind, owning_layer: owningLayer,
    ownership_classification: classification, affected_digests: sorted(affectedDigests), required_repair: requiredRepair,
    owner_approval_required: false, controller_approval_required: false,
    next_action: classification.next_action, defect_sha256: null,
  };
  envelope.affected_digests.forEach((digest) => requireSha(digest, "Spawner defect affected digest"));
  envelope.defect_sha256 = canonicalDigest(digestBody(envelope, "defect_sha256"));
  return envelope;
}

export function compileSpawnerRepairReceipt({defect, patchedLayer, priorVersionSha256, repairedVersionSha256, hostileRegressionSha256, dependencyGraph, recompiledContextSha256, rebuiltSeedSha256, qaReceiptSha256, gitCommit, gitTree, remoteReadbackSha256, retryStartedSha256, observedAtUtc}) {
  assert(defect?.schema === SPAWNER_DEFECT_ENVELOPE_SCHEMA && defect.ownership_classification?.schema === OWNERSHIP_CLASSIFICATION_SCHEMA, "Spawner repair defect is invalid");
  assert(defect.ownership_classification.ownership === "SPAWNER_LANE", "Spawner cannot repair an out-of-lane defect", "OUT_OF_LANE_MUTATION_FORBIDDEN");
  assert(patchedLayer === defect.owning_layer, "Spawner repair patched the wrong governance layer", "WRONG_LAYER_REPAIR");
  for (const value of [priorVersionSha256, repairedVersionSha256, hostileRegressionSha256, recompiledContextSha256, rebuiltSeedSha256, qaReceiptSha256, remoteReadbackSha256, retryStartedSha256]) requireSha(value, "Spawner repair binding");
  assert(typeof gitCommit === "string" && /^[0-9a-f]{40}$/u.test(gitCommit), "Spawner repair Git commit is invalid");
  assert(typeof gitTree === "string" && /^[0-9a-f]{40}$/u.test(gitTree), "Spawner repair Git tree is invalid");
  const invalidated = computeInvalidationClosure({changedDigests: [priorVersionSha256], dependencyGraph});
  assert(invalidated.includes(priorVersionSha256), "Spawner repair invalidation omitted the patched predecessor");
  const receipt = {
    schema: SPAWNER_REPAIR_RECEIPT_SCHEMA, version: 1, status: "REPAIRED_QA_PASS_PUSHED_RETRY_STARTED",
    defect_sha256: defect.defect_sha256, patched_layer: patchedLayer,
    prior_version_sha256: priorVersionSha256, repaired_version_sha256: repairedVersionSha256,
    preserved_history: true, hostile_regression_sha256: hostileRegressionSha256,
    invalidated_digests: invalidated, recompiled_context_sha256: recompiledContextSha256,
    rebuilt_seed_sha256: rebuiltSeedSha256, qa_receipt_sha256: qaReceiptSha256,
    git_commit: gitCommit, git_tree: gitTree, remote_readback_sha256: remoteReadbackSha256,
    retry_started_sha256: retryStartedSha256, observed_at_utc: observedAtUtc, receipt_sha256: null,
  };
  receipt.receipt_sha256 = canonicalDigest(digestBody(receipt, "receipt_sha256"));
  return receipt;
}

export function reenterFailedSpawnerRepair({failedDefect, failureEvidenceSha256, observedAtUtc}) {
  assert(failedDefect?.schema === SPAWNER_DEFECT_ENVELOPE_SCHEMA, "Failed repair defect is invalid");
  requireSha(failureEvidenceSha256, "Failed repair evidence");
  return compileSpawnerDefectEnvelope({
    defectId: `${failedDefect.defect_id}.RETRY`, defectKind: "FAILED_REPAIR", owningLayer: failedDefect.owning_layer,
    withinSpawnerAuthority: true, evidenceSha256: failureEvidenceSha256,
    affectedDigests: [failedDefect.defect_sha256], requiredRepair: "Classify the failed repair as a new defect, preserve prior evidence, patch the owning layer, add a hostile regression, invalidate dependents, and rerun QA.", observedAtUtc,
  });
}

