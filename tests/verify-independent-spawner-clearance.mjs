#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {auditIndependentClearanceFixture, assertVerifiedIndependentClearance, installIndependentClearanceAuthorityStore, verifyIndependentSpawnerClearance} from "../control/independent-spawner-clearance.mjs";
import {prepareProtectedEvaluatorProvisioning} from "../control/protected-evaluator-provisioning.mjs";
import {getSealedCanonicalAuthority} from "../control/sealed-canonical-authority.mjs";
import {prepareCanonicalIndependentClearanceFixture} from "./helpers/independent-clearance-fixture.mjs";

function fixture() { return prepareCanonicalIndependentClearanceFixture(); }
function receiptPath(value) { return path.join(value.authorityRoot, "receipts", `${value.receiptSha256}.json`); }
function mutateJson(filePath, mutate) { const value = JSON.parse(fs.readFileSync(filePath, "utf8")); mutate(value); fs.writeFileSync(filePath, `${JSON.stringify(value)}\n`); }

const valid = fixture();
const audited = auditIndependentClearanceFixture(valid);
assert.equal(audited.receipt.receipt_sha256, valid.receiptSha256);
assert.throws(() => assertVerifiedIndependentClearance(audited.clearance, audited.candidate), /not verified and consumed/iu, "audit-only fixture minted an admission token");

const synthetic = fixture();
assert.throws(() => verifyIndependentSpawnerClearance({authorityRoot: synthetic.authorityRoot, receiptSha256: synthetic.receiptSha256}), /Caller-supplied clearance authority/iu, "caller-selected synthetic candidate was accepted by production verification");

const provisioned = fixture();
const sealedAuthority = getSealedCanonicalAuthority();
const evaluatorProvisioning = prepareProtectedEvaluatorProvisioning({sealedAuthority, clearanceStoreRoot: provisioned.authorityRoot, candidateRepositoryRoot: provisioned.repositoryRoot});
installIndependentClearanceAuthorityStore({sealedAuthority, evaluatorProvisioning});
const verified = verifyIndependentSpawnerClearance({receiptSha256: provisioned.receiptSha256});
assert.doesNotThrow(() => assertVerifiedIndependentClearance(verified, verified.candidate));
assert.throws(() => verifyIndependentSpawnerClearance({receiptSha256: provisioned.receiptSha256}), /already consumed/iu, "production clearance replay survived durable consumption");

for (const [label, mutate, pattern] of [
  ["unknown issuer", (receipt) => { receipt.issuer_id = "EVALUATOR.UNKNOWN"; }, /unknown|role-mismatched/iu],
  ["self issuer", (receipt) => { receipt.issuer_role = "AGENT.SPAWNER_COMPILER"; }, /cannot issue/iu],
  ["mutated body", (receipt) => { receipt.candidate.tree_sha1 = "c".repeat(40); }, /candidate binding|mutated/iu],
  ["partial scope", (receipt) => { receipt.scope.pop(); }, /scope is partial/iu],
  ["superseded receipt", (receipt) => { receipt.supersedes_receipt_sha256 = "d".repeat(64); }, /body was mutated/iu],
]) {
  const hostile = fixture(); mutateJson(receiptPath(hostile), mutate);
  assert.throws(() => auditIndependentClearanceFixture({...hostile, consume: label === "superseded receipt"}), pattern, label);
}

const forgedRoot = fixture();
mutateJson(path.join(forgedRoot.authorityRoot, "evaluator-registry.v2.json"), (registry) => { registry.registry_id = "REGISTRY.SUBSTITUTED"; });
assert.throws(() => auditIndependentClearanceFixture(forgedRoot), /not anchored|digest mismatch/iu);

const revoked = fixture();
mutateJson(path.join(revoked.authorityRoot, "evaluator-registry.v2.json"), (registry) => { registry.evaluators[0].revoked_at_utc = "2026-08-18T00:02:00.000Z"; });
assert.throws(() => auditIndependentClearanceFixture(revoked), /revoked|digest mismatch/iu);

const staleCandidate = fixture();
mutateJson(path.join(staleCandidate.authorityRoot, "candidate-authority.v1.json"), (candidate) => { candidate.commit_sha1 = "d".repeat(40); });
assert.throws(() => auditIndependentClearanceFixture(staleCandidate), /stale or synthetic/iu);

const replay = fixture();
auditIndependentClearanceFixture({...replay, consume: true});
assert.throws(() => auditIndependentClearanceFixture({...replay, consume: true}), /already consumed/iu, "receipt replay survived restart/readback");

const concurrent = fixture();
fs.writeFileSync(path.join(concurrent.authorityRoot, "consumption-ledger.v1.json.lock"), "other-fenced-writer\n");
assert.throws(() => auditIndependentClearanceFixture({...concurrent, consume: true}), /locked by another consumer/iu);

for (const value of [valid, synthetic, provisioned, forgedRoot, revoked, staleCandidate, replay, concurrent]) fs.rmSync(value.root, {recursive: true, force: true});
console.log("PASS canonical independent Spawner clearance: anchored registry, actual Git/files, immutable signature, stale/synthetic/self/revoked/substitution denial, durable replay CAS, and audit-token separation");
