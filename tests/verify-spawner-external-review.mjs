#!/usr/bin/env node

import assert from "node:assert/strict";
import {resolveCanonicalSpawnerBootstrapPackage} from "../control/spawner-bootstrap-governance.mjs";
import {getSealedCanonicalAuthority} from "../control/sealed-canonical-authority.mjs";
import {prepareProtectedSpawnerReviewProvisioning} from "../control/protected-spawner-review-provisioning.mjs";
import {installExternalSpawnerReviewStore, validateExternalSpawnerReviewReplayText} from "../control/spawner-external-review.mjs";
import {canonicalDigest, canonicalJson} from "../control/content-addressing.mjs";

const sealedAuthority = getSealedCanonicalAuthority();
assert.throws(() => resolveCanonicalSpawnerBootstrapPackage(), /not provisioned|handoff|required/iu);
assert.throws(() => prepareProtectedSpawnerReviewProvisioning({sealedAuthority, reviewStoreRoot: "/tmp/attacker"}), /caller-selected external review roots are forbidden/iu);
assert.throws(() => installExternalSpawnerReviewStore({sealedAuthority, reviewProvisioning: Object.freeze({})}), /forged|reconstructed|provisioning/iu);

const registrySha256 = canonicalDigest({registry: "canonical-reviewer-registry"});
const receiptOne = canonicalDigest({receipt: "one"});
const receiptTwo = canonicalDigest({receipt: "two"});
const ledgerBindingSha256 = canonicalDigest({schema: "agentos.spawner_external_review_consumption_head.v1", version: 1, binding_sha256: registrySha256, ledger: "consumed-reviews.jsonl"});
function event(sequence, receipt, priorEventSha256 = null, consumedAtUtc = new Date(Date.now() - 1_000).toISOString()) {
  const value = {sequence, receipt_sha256: receipt, prior_event_sha256: priorEventSha256, consumed_at_utc: consumedAtUtc, event_sha256: null};
  value.event_sha256 = canonicalDigest({...value, event_sha256: null});
  return value;
}
function head(prior) {
  return {
    schema: "agentos.spawner_external_review_consumption_head.v1",
    version: 1,
    binding_sha256: ledgerBindingSha256,
    sequence: prior.length,
    head_event_sha256: prior.at(-1)?.event_sha256 ?? null,
    ledger_sha256: canonicalDigest(prior),
  };
}
const first = event(1, receiptOne);
const second = event(2, receiptTwo, first.event_sha256);
const validLedger = `${canonicalJson(first)}\n${canonicalJson(second)}\n`;
assert.equal(validateExternalSpawnerReviewReplayText({binding_sha256: ledgerBindingSha256, rawLedger: validLedger, head: head([first, second])}).prior.length, 2);
assert.throws(() => validateExternalSpawnerReviewReplayText({binding_sha256: ledgerBindingSha256, rawLedger: `${canonicalJson(first)}\n`, head: head([first, second])}), /head does not match|ledger/iu);
assert.throws(() => validateExternalSpawnerReviewReplayText({binding_sha256: ledgerBindingSha256, rawLedger: validLedger.replace(first.event_sha256, receiptTwo), head: head([first, second])}), /chain|ledger/iu);
assert.throws(() => validateExternalSpawnerReviewReplayText({binding_sha256: ledgerBindingSha256, rawLedger: `${canonicalJson(first)}\n${canonicalJson(first)}\n`, head: head([first, first])}), /sequence|receipt|ledger/iu);
assert.throws(() => validateExternalSpawnerReviewReplayText({binding_sha256: ledgerBindingSha256, rawLedger: validLedger, head: null}), /missing.*head/iu);
assert.throws(() => validateExternalSpawnerReviewReplayText({binding_sha256: ledgerBindingSha256, rawLedger: `${canonicalJson(event(1, receiptOne, null, new Date(Date.now() + 60_000).toISOString()))}\n`, head: head([first])}), /time|ledger/iu);
console.log("PASS external Spawner review: canonical fixed-root provisioning, sealed path walk, filename binding, chained replay ledger, durable head, and hostile tamper cases fail closed");
