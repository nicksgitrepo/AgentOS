#!/usr/bin/env node

import {canonicalDigest} from "./content-addressing.mjs";
import {assertSealedCanonicalAuthority} from "./sealed-canonical-authority.mjs";
import {installCanonicalIndependentClearanceAuthorityStore, installIndependentClearanceAuthorityStore} from "./independent-spawner-clearance.mjs";
import {installExternalSpawnerReviewStore} from "./spawner-external-review.mjs";
import {prepareCanonicalGlobalGovernanceGenesis} from "./canonical-global-governance-genesis.mjs";
import {resolveCanonicalSpawnerEvaluatorHandoff} from "./canonical-spawner-evaluator-handoff.mjs";

const prepared = new WeakSet();
function fail(message, code = "SPAWNER_BOOTSTRAP_PREPARATION_INVALID") { const error = new Error(message); error.code = code; throw error; }

export function prepareAgentSpawnerBootstrapAuthority({sealedAuthority, evaluatorProvisioning, reviewProvisioning} = {}) {
  assertSealedCanonicalAuthority(sealedAuthority);
  const production = evaluatorProvisioning === undefined && reviewProvisioning === undefined;
  if ((evaluatorProvisioning === undefined) !== (reviewProvisioning === undefined)) fail("Spawner Bootstrap evaluator and review provisioning must be paired", "SPAWNER_BOOTSTRAP_EXTERNAL_PROVISIONING_REQUIRED");
  const handoff = production ? resolveCanonicalSpawnerEvaluatorHandoff({sealedAuthority}) : null;
  evaluatorProvisioning ??= handoff.evaluatorProvisioning;
  reviewProvisioning ??= handoff.reviewProvisioning;
  const genesis = prepareCanonicalGlobalGovernanceGenesis({sealedAuthority});
  const clearanceStore = production ? installCanonicalIndependentClearanceAuthorityStore({sealedAuthority, evaluatorProvisioning}) : installIndependentClearanceAuthorityStore({sealedAuthority, evaluatorProvisioning});
  const reviewStore = installExternalSpawnerReviewStore({sealedAuthority, reviewProvisioning});
  const capability = Object.freeze(Object.create(null)); prepared.add(capability);
  return Object.freeze({capability, globalGovernanceAuthorityStore: genesis.authorityStore, clearance_receipt_sha256: handoff?.clearance_receipt_sha256 ?? null, review_receipt_sha256: handoff?.review_receipt_sha256 ?? null, global_memory: Object.freeze({snapshot_sha256: genesis.snapshot_sha256, event_sha256: genesis.event_sha256, ledger_head_sha256: genesis.ledger_head_sha256, readback_sha256: genesis.readback_sha256, bootstrap_sha256: genesis.bootstrap_sha256, spawner_projection_sha256: genesis.spawner_projection_sha256}), preparation_sha256: canonicalDigest({schema: "agentos.spawner_bootstrap_preparation.v2", clearance_store: Boolean(clearanceStore), review_store: Boolean(reviewStore), global_memory_snapshot_sha256: genesis.snapshot_sha256, production_signing_key_embedded: false})});
}

export function assertAgentSpawnerBootstrapPrepared(capability) {
  if (!prepared.has(capability)) fail("Spawner Bootstrap preparation capability was forged or reconstructed", "SPAWNER_BOOTSTRAP_EXTERNAL_PROVISIONING_REQUIRED");
  return capability;
}
