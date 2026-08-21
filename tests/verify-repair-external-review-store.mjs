#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {consumeCanonicalRepairExternalReview} from "../control/repair-external-review-store.mjs";
import {getSealedCanonicalAuthority} from "../control/sealed-canonical-authority.mjs";
import {inspectCanonicalRepairCandidate} from "../control/repair-governed-admission.mjs";

const authority = getSealedCanonicalAuthority();
const inspected = inspectCanonicalRepairCandidate();
const candidate = {...inspected.candidate, candidate_commit: inspected.candidate_commit, candidate_tree: inspected.candidate_tree};
const operationalContext = {role_class: "WORKING_AGENT", context_sha256: "a".repeat(64), snapshot_sha256: "b".repeat(64)};
const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {encoding: "utf8"}).trim();
const externalRoot = path.join(common, "agentos-independent-evaluator", inspected.candidate_commit, "repair");
if (fs.existsSync(externalRoot)) {
  const reviewFiles = fs.readdirSync(externalRoot).filter((name) => /^review-[0-9a-f]{64}\.v1\.json$/u.test(name));
  for (const name of reviewFiles) {
    const review = JSON.parse(fs.readFileSync(path.join(externalRoot, name), "utf8"));
    assert.equal(name, `review-${review.review_sha256}.v1.json`, "review file must be content-addressed by its digest");
  }
}
assert.throws(() => consumeCanonicalRepairExternalReview({sealedAuthority: authority, candidate, operationalContext, receiptRef: `ref:temporary-role-review/${"a".repeat(64)}`, root: "/tmp"}), (error) => error.code === "REPAIR_EXTERNAL_REVIEW_CALLER_AUTHORITY_FORBIDDEN");
assert.throws(() => consumeCanonicalRepairExternalReview({sealedAuthority: authority, candidate, operationalContext, receiptRef: `ref:temporary-role-review/${"a".repeat(64)}`}), (error) => error.code === "REPAIR_EXTERNAL_REVIEW_PROVISIONING_REQUIRED");
console.log("PASS Repair external review consumer: caller roots are rejected and absent external evaluator provisioning fails closed");
