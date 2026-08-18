#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {prepareCanonicalSpawnerBootstrapCandidateForIndependentEvaluation, resolveCanonicalSpawnerBootstrapPackage} from "../control/spawner-bootstrap-governance.mjs";
import {getSealedCanonicalAuthority} from "../control/sealed-canonical-authority.mjs";
import {prepareProtectedSpawnerReviewProvisioning} from "../control/protected-spawner-review-provisioning.mjs";
import {installExternalSpawnerReviewStore} from "../control/spawner-external-review.mjs";
import {provisionTestExternalSpawnerReview} from "./helpers/spawner-external-review-fixture.mjs";

const candidate = prepareCanonicalSpawnerBootstrapCandidateForIndependentEvaluation();
assert.throws(() => resolveCanonicalSpawnerBootstrapPackage(), /not provisioned/iu);
assert.throws(() => installExternalSpawnerReviewStore({sealedAuthority: getSealedCanonicalAuthority(), reviewProvisioning: {root: "/tmp/attacker"}}), /forged|reconstructed|provisioning/iu);

const valid = provisionTestExternalSpawnerReview({candidate});
const accepted = resolveCanonicalSpawnerBootstrapPackage();
assert.equal(accepted.external_review.receipt_sha256, valid.receipt.receipt_sha256);
assert.throws(() => resolveCanonicalSpawnerBootstrapPackage(), /already consumed/iu);

const stale = provisionTestExternalSpawnerReview({candidate, install: false});
const receiptPath = path.join(stale.root, "receipts", `${stale.receipt.receipt_sha256}.json`);
const receipt = JSON.parse(fs.readFileSync(receiptPath)); receipt.candidate_root_sha256 = "a".repeat(64); receipt.receipt_sha256 = canonicalDigest({...receipt, receipt_sha256: null, signature_base64: null}); fs.writeFileSync(receiptPath, JSON.stringify(receipt));
const sealed = getSealedCanonicalAuthority(), staleProvision = prepareProtectedSpawnerReviewProvisioning({sealedAuthority: sealed, reviewStoreRoot: stale.root}); installExternalSpawnerReviewStore({sealedAuthority: sealed, reviewProvisioning: staleProvision});
assert.throws(() => resolveCanonicalSpawnerBootstrapPackage(), /candidate or executed evidence binding differs/iu);

const revoked = provisionTestExternalSpawnerReview({candidate, install: false});
const registryPath = path.join(revoked.root, "reviewer-registry.v1.json"), registry = JSON.parse(fs.readFileSync(registryPath)); registry.reviewers[0].status = "REVOKED"; registry.registry_sha256 = canonicalDigest({...registry, registry_sha256: null}); fs.writeFileSync(registryPath, JSON.stringify(registry));
const revokedProvision = prepareProtectedSpawnerReviewProvisioning({sealedAuthority: sealed, reviewStoreRoot: revoked.root});
assert.throws(() => installExternalSpawnerReviewStore({sealedAuthority: sealed, reviewProvisioning: revokedProvision}), /not separately admitted/iu);

for (const value of [valid, stale, revoked]) fs.rmSync(value.root, {recursive: true, force: true});
console.log("PASS external Spawner review: absent provisioning fails closed, separately admitted evaluator receipt enables real resolution, replay/candidate mutation/revocation fail, and candidate-supplied provisioning is rejected");
