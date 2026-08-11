#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  compileBlockedDevelopmentPromotionGate,
  compileReleasePromotionGate,
  validateReleasePromotionGate,
} from "../control/release-promotion-gate.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const source = {role: "ACTIVE_DEVELOPMENT_CHECKOUT", status: "VERIFIED", commit_sha256: "e".repeat(64), tree_sha256: "a".repeat(64), artifact_sha256: "f".repeat(64), manifest_sha256: "0".repeat(64), verification_sha256: "b".repeat(64)};
const target = {role: "STERILE_RELEASE_CHECKOUT", status: "VERIFIED", commit_sha256: "1".repeat(64), tree_sha256: "c".repeat(64), artifact_sha256: "2".repeat(64), manifest_sha256: "3".repeat(64), verification_sha256: "d".repeat(64)};
const verification = {ARCHITECTURE: "PASS", CANONICAL: "PASS", HYGIENE: "PASS", PORTABILITY: "PASS", RELEASE_SAFETY: "PASS"};

const ready = compileReleasePromotionGate({sourceEvidence: source, sterileReleaseEvidence: target, verification, changedPaths: ["control/example.mjs", "docs/example.md"], safetyGateSha256: "9".repeat(64)});
assert.equal(ready.status, "READY_FOR_EXPLICIT_PROMOTION");
assert.equal(ready.publishing, false);
assert.equal(ready.action_taken, "NONE");
validateReleasePromotionGate(ready);

const blocked = compileBlockedDevelopmentPromotionGate({changedPaths: ["control/example.mjs"]});
assert.equal(blocked.status, "BLOCKED_STERILE_RELEASE_NOT_PROMOTED");
assert.deepEqual(blocked.blockers, ["STERILE_RELEASE_NOT_PROMOTED"]);
assert.equal(blocked.sterile_release.status, "NOT_VERIFIED");
assert.equal(blocked.publishing, false);
validateReleasePromotionGate(blocked);

assert.throws(() => compileReleasePromotionGate({
  sourceEvidence: source,
  sterileReleaseEvidence: target,
  verification: {...verification, CANONICAL: "FAIL"},
}), /release verification result is invalid/u);
assert.throws(() => validateReleasePromotionGate({...ready, pushes: true}), /pushes must remain false/u);
const currentRecord = JSON.parse(fs.readFileSync(path.join(root, "docs/release-development-promotion-blocker.v1.json"), "utf8"));
assert.equal(currentRecord.status, "BLOCKED_STERILE_RELEASE_NOT_PROMOTED");
assert.equal(currentRecord.publishing, false);
assert.equal(currentRecord.action_taken, "NONE");
validateReleasePromotionGate(currentRecord);

console.log("PASS release promotion gate: development/release mismatch is typed, content-addressed, and non-publishing");
