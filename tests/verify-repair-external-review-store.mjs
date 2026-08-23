#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {consumeCanonicalRepairExternalReview} from "../control/repair-external-review-store.mjs";
import {getSealedCanonicalAuthority} from "../control/sealed-canonical-authority.mjs";
import {inspectCanonicalRepairCandidate} from "../control/repair-governed-admission.mjs";

const authority = getSealedCanonicalAuthority();
assert.throws(
  () => inspectCanonicalRepairCandidate(),
  (error) => error.code === "REPAIR_QUALIFICATION_REQUIRED",
  "changed Repair bytes must invalidate the prior qualification before external review consumption",
);
const candidateCommit = execFileSync("git", ["rev-parse", "HEAD"], {encoding: "utf8"}).trim();
const candidateTree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {encoding: "utf8"}).trim();
const candidate = {
  role_id: "AGENTOS.REPAIR",
  candidate_root_sha256: "c".repeat(64),
  block_sha256: "d".repeat(64),
  gate_inventory_sha256: "e".repeat(64),
  fixture_inventory_sha256: "f".repeat(64),
  candidate_commit: candidateCommit,
  candidate_tree: candidateTree,
};
const operationalContext = {role_class: "WORKING_AGENT", context_sha256: "a".repeat(64), snapshot_sha256: "b".repeat(64)};
const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {encoding: "utf8"}).trim();
const externalRoot = path.join(common, "agentos-independent-evaluator", candidateCommit, "repair");
if (fs.existsSync(externalRoot)) {
  const reviewFiles = fs.readdirSync(externalRoot).filter((name) => /^review-[0-9a-f]{64}\.v1\.json$/u.test(name));
  for (const name of reviewFiles) {
    const review = JSON.parse(fs.readFileSync(path.join(externalRoot, name), "utf8"));
    assert.equal(name, `review-${review.review_sha256}.v1.json`, "review file must be content-addressed by its digest");
  }
}
assert.throws(() => consumeCanonicalRepairExternalReview({sealedAuthority: authority, candidate, operationalContext, receiptRef: `ref:temporary-role-review/${"a".repeat(64)}`, root: "/tmp"}), (error) => error.code === "REPAIR_EXTERNAL_REVIEW_CALLER_AUTHORITY_FORBIDDEN");
assert.throws(() => consumeCanonicalRepairExternalReview({sealedAuthority: authority, candidate, operationalContext, receiptRef: `ref:temporary-role-review/${"a".repeat(64)}`}), (error) => error.code === "REPAIR_EXTERNAL_REVIEW_PROVISIONING_REQUIRED");
console.log("PASS Repair external review consumer: stale qualification is rejected, caller roots are rejected, and absent external evaluator provisioning fails closed");
