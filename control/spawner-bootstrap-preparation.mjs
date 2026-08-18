#!/usr/bin/env node

import {canonicalDigest} from "./content-addressing.mjs";
import {assertSealedCanonicalAuthority} from "./sealed-canonical-authority.mjs";
import {installIndependentClearanceAuthorityStore} from "./independent-spawner-clearance.mjs";
import {installExternalSpawnerReviewStore} from "./spawner-external-review.mjs";

const prepared = new WeakSet();
function fail(message, code = "SPAWNER_BOOTSTRAP_PREPARATION_INVALID") { const error = new Error(message); error.code = code; throw error; }

export function prepareAgentSpawnerBootstrapAuthority({sealedAuthority, evaluatorProvisioning, reviewProvisioning} = {}) {
  assertSealedCanonicalAuthority(sealedAuthority);
  if (!evaluatorProvisioning || !reviewProvisioning) fail("Spawner Bootstrap requires separately provisioned clearance and reviewer authority", "SPAWNER_BOOTSTRAP_EXTERNAL_PROVISIONING_REQUIRED");
  const clearanceStore = installIndependentClearanceAuthorityStore({sealedAuthority, evaluatorProvisioning});
  const reviewStore = installExternalSpawnerReviewStore({sealedAuthority, reviewProvisioning});
  const capability = Object.freeze(Object.create(null)); prepared.add(capability);
  return Object.freeze({capability, preparation_sha256: canonicalDigest({schema: "agentos.spawner_bootstrap_preparation.v1", clearance_store: Boolean(clearanceStore), review_store: Boolean(reviewStore), production_signing_key_embedded: false})});
}

export function assertAgentSpawnerBootstrapPrepared(capability) {
  if (!prepared.has(capability)) fail("Spawner Bootstrap preparation capability was forged or reconstructed", "SPAWNER_BOOTSTRAP_EXTERNAL_PROVISIONING_REQUIRED");
  return capability;
}
