#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {installAuditorRoundReviewAuthority, consumeAuditorRoundReview, AUDITOR_ROUND_REVIEW_SCHEMA} from "../control/auditor-round-review-authority.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const schema = JSON.parse(fs.readFileSync(path.join(root, "schemas/auditor-round-independent-review.v1.json"), "utf8"));
assert.equal(schema.properties.schema.const, AUDITOR_ROUND_REVIEW_SCHEMA);
assert.throws(() => installAuditorRoundReviewAuthority({sealedAuthority: Object.freeze({}), reviewProvisioning: Object.freeze({})}), /Authority capability|provisioning/u);
assert.throws(() => consumeAuditorRoundReview({authority: Object.freeze({}), receiptSha256: "a".repeat(64)}), /authority must be installed/u);
console.log("PASS auditor-round review authority rejects forged or absent sealed provisioning and requires external receipt custody");
