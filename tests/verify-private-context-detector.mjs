#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  PRIVATE_CONTEXT_CATEGORIES,
  PRIVATE_CONTEXT_DETECTOR_SCHEMA,
  findPrivateContextLeaks,
  publicContextDetectorContract,
} from "../control/private-context-detector.mjs";

assert.equal(PRIVATE_CONTEXT_DETECTOR_SCHEMA, "agentos.private_context_detector.v1");
assert.deepEqual(publicContextDetectorContract().categories, [...PRIVATE_CONTEXT_CATEGORIES]);
assert.equal(publicContextDetectorContract().generic_rules_only, true);
assert.equal(publicContextDetectorContract().runtime_identity_terms, "TRANSIENT_INPUT_ONLY");
assert.equal(publicContextDetectorContract().persisted_private_values, "FORBIDDEN");

const syntheticPath = ["/", "private", "/", "project", "/", "token.txt"].join("");
const syntheticSecret = ["access", "_", "token=", "present-value"].join("");
const pathLeaks = findPrivateContextLeaks(`Use ${syntheticPath}`);
const secretLeaks = findPrivateContextLeaks(syntheticSecret);
assert(pathLeaks.some((leak) => leak.category === "PRIVATE_PATH"));
assert(secretLeaks.some((leak) => leak.category === "SECRET_VALUE"));
assert.equal(findPrivateContextLeaks("generic project identity", {identityTerms: ["private-customer"]}).length, 0);
assert.equal(findPrivateContextLeaks("private-customer", {identityTerms: ["private-customer"]})[0].category, "RUNTIME_PROJECT_IDENTITY");
assert(findPrivateContextLeaks(`Use ${syntheticPath}`).every((leak) => !("match" in leak)));

process.stdout.write("PASS private-context detector contract\n");
